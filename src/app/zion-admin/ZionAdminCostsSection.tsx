"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCostMetric, type CostCompleteness, type CostSourceAvailability } from "@/lib/server/zion-admin-costs";
import ZionAdminOpenAiOfficialCosts from "./ZionAdminOpenAiOfficialCosts";
import ZionAdminMetaCosts from "./ZionAdminMetaCosts";

type CostFrequency = "monthly" | "annual";
type FixedCost = { id: string; name: string; amount_cents: number; frequency: CostFrequency; enabled: boolean; effective_month: string };
type MonthlyRow = { month: string; closed: boolean; fixedCents: number; variableCents: number | null; totalCents: number | null; aiCostUsd: number | null; fxRate: number | null; executions: number; unpriced: number; tokens: number | null; costCompleteness: CostCompleteness; tokenCompleteness: CostCompleteness };
type CostBreakdown = { usd: number | null; tokens: number | null; runs: number; costCompleteness: CostCompleteness; tokenCompleteness: CostCompleteness };
type VariableExpense = { id: string; idempotency_key: string; name: string; category: string; description: string | null; amount_minor: number | string; currency: "BRL" | "USD"; expense_date: string; competence_month: string; source: "manual"; status: "active" | "cancelled"; created_at: string; updated_at: string; cancelled_at: string | null };
type CostData = {
  months: MonthlyRow[];
  fixedCosts: FixedCost[];
  closeCandidates: string[];
  historicalClosures: Array<{ month: string; total_brl_cents: number; fixed_brl_cents: number; variable_brl_cents: number }>;
  totals: {
    fixedCents: number; variableCents: number | null; totalCents: number | null; aiCostUsd: number | null;
    costCompleteness: CostCompleteness; tokenCompleteness: CostCompleteness;
    executions: number; tokens: number | null; unpricedExecutions: number;
    messagesSales: number | null; messagesAssistant: number | null;
    breakdown: Record<string,CostBreakdown>;
  };
  dataAvailability?: { aiRuns: CostSourceAvailability; fixedCosts: CostSourceAvailability; ptax: CostSourceAvailability; messagesSales: CostSourceAvailability; messagesAssistant: CostSourceAvailability; variableExpenses?: CostSourceAvailability };
  variableExpenses: VariableExpense[] | null;
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
export function costUsd(value: number | null | undefined, availability: CostSourceAvailability | unknown, completeness: CostCompleteness | unknown) {
  return formatCostMetric(value, availability, completeness, (known) => usd(known));
}
export function costNumber(value: number | null | undefined, availability: CostSourceAvailability | unknown, completeness: CostCompleteness | unknown) {
  return formatCostMetric(value, availability, completeness, (known) => new Intl.NumberFormat("pt-BR").format(known));
}
function sourceNumber(value: number | null | undefined, availability: CostSourceAvailability | unknown) {
  if (availability === "unavailable") return "Indisponível";
  if (availability === "partial") return "Parcial";
  return number(value);
}
export function formatAiTypeMessages(
  key: string,
  messagesSales: number | null | undefined,
  messagesAssistant: number | null | undefined,
  messagesSalesAvailability: CostSourceAvailability | unknown,
  messagesAssistantAvailability: CostSourceAvailability | unknown,
) {
  if (key === "sales") return `Mensagens: ${sourceNumber(messagesSales, messagesSalesAvailability)}`;
  if (key === "assistant") return `Mensagens: ${sourceNumber(messagesAssistant, messagesAssistantAvailability)}`;
  return null;
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
  const [variableEditing,setVariableEditing]=useState<VariableExpense | "new" | null>(null);
  const [variableName,setVariableName]=useState("");
  const [variableCategory,setVariableCategory]=useState("");
  const [variableDescription,setVariableDescription]=useState("");
  const [variableAmount,setVariableAmount]=useState("");
  const [variableCurrency,setVariableCurrency]=useState<"BRL"|"USD">("BRL");
  const [variableDate,setVariableDate]=useState(localToday);
  const variableOperationKey=useRef<string|null>(null);

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



  function startEditing(item: FixedCost|"new"){
    setEditing(item);setFeedback(null);
    if(item==="new"){setName("");setAmount("");setFrequency("monthly");}
    else {setName(item.name);setAmount((item.amount_cents/100).toFixed(2).replace(".",","));setFrequency(item.frequency);}
  }
  function startVariableEditing(item: VariableExpense|"new"){
    setVariableEditing(item);setFeedback(null);variableOperationKey.current=null;
    if(item==="new"){setVariableName("");setVariableCategory("");setVariableDescription("");setVariableAmount("");setVariableCurrency("BRL");setVariableDate(localToday());}
    else {setVariableName(item.name);setVariableCategory(item.category);setVariableDescription(item.description||"");setVariableAmount((Number(item.amount_minor)/100).toFixed(2));setVariableCurrency(item.currency);setVariableDate(item.expense_date);}
  }
  async function submitVariable(action:"add_variable"|"edit_variable"|"cancel_variable",item?:VariableExpense){
    if(saving) return;
    if(action==="cancel_variable" && !window.confirm("Cancelar esta despesa? O lançamento continuará disponível no histórico de auditoria.")) return;
    if(!variableOperationKey.current) variableOperationKey.current=`zion-admin-variable-${crypto.randomUUID()}`;
    if(action!=="cancel_variable" && (!variableName.trim() || !variableCategory.trim() || !/^\d+(?:[.,]\d{1,2})?$/.test(variableAmount.trim()) || !variableDate)) {setFeedback("Informe nome, categoria, valor e data válidos.");return;}
    setSaving(true);setFeedback(null);
    try {
      const response=await fetch("/api/zion-admin/costs",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({action,operationKey:variableOperationKey.current,id:item?.id,name:action==="cancel_variable"?undefined:variableName,category:action==="cancel_variable"?undefined:variableCategory,description:action==="cancel_variable"?undefined:variableDescription,amount:action==="cancel_variable"?undefined:variableAmount.replace(",","."),currency:action==="cancel_variable"?undefined:variableCurrency,expenseDate:action==="cancel_variable"?undefined:variableDate,competenceMonth:action==="cancel_variable"?undefined:`${variableDate.slice(0,7)}-01`,expectedUpdatedAt:action==="edit_variable"?item?.updated_at:undefined})});
      const payload=await response.json().catch(()=>null);
      if(!response.ok) throw new Error(payload?.error||"Não foi possível salvar a despesa variável.");
      setVariableEditing(null);variableOperationKey.current=null;setFeedback(action==="cancel_variable"?"Despesa cancelada e preservada no histórico.":"Despesa variável salva.");void fetchCosts();
    } catch(caught){setFeedback(caught instanceof Error?caught.message:"Falha ao salvar a despesa variável.");}
    finally{setSaving(false);}
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
    <ZionAdminOpenAiOfficialCosts />
    <ZionAdminMetaCosts />
    {data?<>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <FinancialCard label="Custos fixos" value={brl(data.totals.fixedCents)} sub="Despesas cadastradas, conforme a vigência" />
        <FinancialCard label="IA variável" value={data.totals.variableCents != null && data.dataAvailability?.ptax === "available" && data.totals.costCompleteness === "complete" ? brl(data.totals.variableCents) : data.dataAvailability?.ptax === "unavailable" ? "Indisponível" : "Incompleto"} sub={`${costUsd(data.totals.aiCostUsd,data.dataAvailability?.aiRuns,data.totals.costCompleteness)} em custos registrados`} />
        <FinancialCard accent label="Total consolidado" value={data.totals.totalCents != null && data.dataAvailability?.ptax === "available" && data.totals.costCompleteness === "complete" ? brl(data.totals.totalCents) : data.dataAvailability?.ptax === "unavailable" ? "Indisponível" : "Incompleto"} sub="Fixos + consumo da IA, sem dupla contagem" />
        <FinancialCard label="Execuções da IA" value={sourceNumber(data.totals.executions,data.dataAvailability?.aiRuns)} sub={`${costNumber(data.totals.tokens,data.dataAvailability?.aiRuns,data.totals.tokenCompleteness)} tokens utilizados`} />
      </div>
      {(data.totals.variableCents==null || data.totals.unpricedExecutions>0)?<div className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">A conversão em reais está incompleta: cotação PTAX indisponível ou {data.totals.unpricedExecutions} execução(ões) sem custo registrado. Não presumimos custo zero.</div>:null}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className={`${PALETTE.surface} p-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-white">Despesas fixas</h3><p className="text-[11px] text-[#91a7b6]">Edições e exclusões passam a valer em {nextMonthLabel()}.</p></div><button className={PALETTE.action} type="button" onClick={()=>startEditing("new")}>+ Adicionar custo</button></div>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase text-[#7d9bad]"><tr className="border-b border-[#293b46]"><th className="pb-2">Custo</th><th className="pb-2">Periodicidade</th><th className="pb-2 text-right">Valor</th><th className="pb-2 text-right">Ações</th></tr></thead><tbody>{data.fixedCosts.map((item)=><tr className="border-b border-[#24333c] last:border-0" key={item.id}><td className="py-2.5 pr-2 font-medium text-[#e3f1f2]">{item.name}{!item.enabled?<span className="ml-2 text-[10px] text-amber-300">Excluído a partir da vigência</span>:null}</td><td className="py-2 text-[#90a5b4]">{item.frequency==="annual"?"Anual (rateado)":"Mensal"}</td><td className="py-2 text-right text-[#d9f9fb] tabular-nums">{brl(item.amount_cents)}</td><td className="py-2 text-right whitespace-nowrap"><button type="button" aria-label={`Editar ${item.name}`} onClick={()=>startEditing(item)} className="rounded-md p-1.5 text-[#6bd1df] hover:bg-cyan-500/10" title="Editar custo">✎</button><button type="button" aria-label={`Excluir ${item.name}`} onClick={()=>void submitCost("remove",item)} disabled={saving} className="rounded-md p-1.5 text-red-300 hover:bg-red-500/10" title="Excluir dos próximos meses">✕</button></td></tr>)}</tbody></table></div>
          <p className="mt-2 text-[11px] text-[#819eae]">Domínio: os R$ 40 anuais são distribuídos por 12 meses, com ajuste dos centavos para totalizar exatamente R$ 40 no ano.</p>
        </section>
        <section className={`${PALETTE.surface} p-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-white">Despesas variáveis manuais</h3><p className="text-[11px] text-[#91a7b6]">Lançamentos pontuais da competência selecionada. Não entram automaticamente no total consolidado.</p></div><button className={PALETTE.action} type="button" onClick={()=>startVariableEditing("new")}>+ Adicionar despesa</button></div>
          {data.dataAvailability?.variableExpenses==="unavailable"||data.variableExpenses===null?<div role="status" className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/[0.08] p-3 text-xs text-amber-100">Despesas variáveis indisponíveis. Nenhum total foi presumido.</div>:data.variableExpenses.length===0?<p className="mt-3 rounded-lg border border-[#293943] p-3 text-xs text-[#91a7b6]">Nenhuma despesa manual encontrada neste período.</p>:<div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase text-[#7d9bad]"><tr className="border-b border-[#293b46]"><th className="pb-2">Data</th><th className="pb-2">Despesa</th><th className="pb-2">Categoria</th><th className="pb-2 text-right">Valor</th><th className="pb-2">Estado</th><th className="pb-2 text-right">Ações</th></tr></thead><tbody>{data.variableExpenses.map(item=><tr key={item.id} className="border-b border-[#24333c] last:border-0"><td className="py-2.5">{item.expense_date}</td><td className="py-2.5 font-medium text-[#e3f1f2]">{item.name}{item.description?<span className="block text-[10px] text-[#819eae]">{item.description}</span>:null}</td><td className="py-2.5 text-[#90a5b4]">{item.category}</td><td className="py-2.5 text-right tabular-nums">{item.currency} {(Number(item.amount_minor)/100).toFixed(2)}</td><td className={`py-2.5 ${item.status==="cancelled"?"text-[#9aaab3]":"text-emerald-300"}`}>{item.status==="cancelled"?"Cancelada":"Ativa"}</td><td className="py-2.5 text-right whitespace-nowrap">{item.status==="active"?<><button type="button" aria-label={`Editar ${item.name}`} onClick={()=>startVariableEditing(item)} className="rounded-md p-1.5 text-[#6bd1df] hover:bg-cyan-500/10">Editar</button><button type="button" aria-label={`Cancelar ${item.name}`} onClick={()=>void submitVariable("cancel_variable",item)} disabled={saving} className="rounded-md p-1.5 text-red-300 hover:bg-red-500/10">Cancelar</button></>:<span className="text-[10px] text-[#819eae]">Histórico</span>}</td></tr>)}</tbody></table></div>}
        </section>
        <section className={`${PALETTE.surface} p-3 lg:col-span-2`}><h3 className="text-sm font-semibold text-white">Uso da IA por tipo</h3><p className="mt-1 text-[11px] text-[#91a7b6]">O custo pertence à execução de IA, não é cobrado de novo por token ou mensagem.</p><div className="mt-3 rounded-lg border border-cyan-400/30 bg-[#122c37] p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-[#c5f7fa]">Consumo total em USD</span><span className="text-sm font-semibold tabular-nums text-[#8ae6ec]">{costUsd(data.totals.aiCostUsd,data.dataAvailability?.aiRuns,data.totals.costCompleteness)}</span></div><p className="mt-1 text-[10px] text-[#8ba4b2]">Total consolidado da fonte ai_runs.cost_usd</p></div><div className="mt-2 space-y-2">{CATEGORIES.map(([key,label])=>{const item=data.totals.breakdown[key];const messages=formatAiTypeMessages(key,data.totals.messagesSales,data.totals.messagesAssistant,data.dataAvailability?.messagesSales,data.dataAvailability?.messagesAssistant);return <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-[#293943] bg-[#0b141c] p-2.5"><div><div className="text-xs font-medium text-[#e8f2f5]">{label}</div><div className="text-[11px] text-[#8ba4b2]">{sourceNumber(item?.runs,data.dataAvailability?.aiRuns)} exec. · {costNumber(item?.tokens,data.dataAvailability?.aiRuns,item?.tokenCompleteness)} tokens{messages?<><br />{messages}</>:null}</div></div><div className="text-right text-xs font-semibold tabular-nums text-[#8ae6ec]">{costUsd(item?.usd,data.dataAvailability?.aiRuns,item?.costCompleteness)}<div className="text-[10px] font-normal text-[#8ba4b2]">Custo individual em USD</div></div></div>;})}</div></section>
      </div>
      <section className={`${PALETTE.surface} p-3`}><div className="flex flex-wrap justify-between gap-2"><div><h3 className="text-sm font-semibold text-white">Fechamentos e histórico</h3><p className="mt-1 text-[11px] text-[#91a7b6]">Fechamentos anteriores são preservados sem recálculo, mesmo após excluir ou alterar despesas.</p></div><span className="h-fit rounded-lg border border-[#2e6170] bg-[#153541] px-2 py-1 text-[10px] text-cyan-100">{data.closeCandidates.length?`${data.closeCandidates.length} pendente(s)`:"Atualizado"}</span></div><div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-[#31434e] text-left text-[10px] uppercase text-[#8da7b7]"><th className="pb-2">Mês</th><th className="pb-2 text-right">Fixos</th><th className="pb-2 text-right">IA variável</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">Situação</th></tr></thead><tbody>{displayData.map(row=><tr key={row.month} className="border-b border-[#253742] last:border-0"><td className="py-2.5 text-[#e4f2f4]">{MONTHS[Number(row.month.slice(5,7))-1]} {row.month.slice(0,4)}</td><td className="py-2.5 text-right tabular-nums">{brl(row.fixedCents)}</td><td className="py-2.5 text-right tabular-nums">{brl(row.variableCents)}</td><td className="py-2.5 text-right font-semibold tabular-nums text-[#8ae6ef]">{brl(row.totalCents)}</td><td className="py-2.5 text-right text-[11px]">{row.closed?<span className="text-emerald-300">Fechado</span>:<span className="text-amber-200">Aberto / não fechado</span>}</td></tr>)}</tbody></table></div></section>
      <p className="text-[11px] leading-5 text-[#879da9]">{data.note} Fonte da cotação: {data.fxSource}. Para reconciliação com a fatura real de cartão, é necessário conferir a taxa efetivamente cobrada.</p>
    </>:null}
    {editing?<div role="dialog" aria-modal="true" aria-label="Editar despesa fixa" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-3"><form onSubmit={e=>{e.preventDefault();void submitCost(editing==="new"?"add":"edit",editing==="new"?undefined:editing);}} className="w-full max-w-md space-y-3 rounded-2xl border border-[#3b7e8b] bg-[#0d1b24] p-5 shadow-2xl"><div><h3 className="text-base font-semibold text-white">{editing==="new"?"Adicionar despesa fixa":"Editar despesa fixa"}</h3><p className="mt-1 text-xs text-[#a2b8c3]">A alteração começará em {nextMonthLabel()}. Fechamentos antigos não serão modificados.</p></div><label className="block text-xs text-[#aebdc5]">Nome<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} placeholder="Ex.: Hospedagem"/></label><label className="block text-xs text-[#aebdc5]">Valor em reais<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} placeholder="100,00"/></label><label className="block text-xs text-[#aebdc5]">Frequência<select value={frequency} onChange={e=>setFrequency(e.target.value as CostFrequency)} className={`${PALETTE.input} mt-1 w-full`}><option value="monthly">Mensal</option><option value="annual">Anual (dividido por 12)</option></select></label><div className="flex justify-end gap-2"><button type="button" className="rounded-lg border border-[#3e4b57] px-3 py-2 text-xs text-white" onClick={()=>setEditing(null)}>Cancelar</button><button disabled={saving} type="submit" className={PALETTE.action}>{saving?"Salvando...":"Salvar para o próximo mês"}</button></div></form></div>:null}
    {variableEditing?<div role="dialog" aria-modal="true" aria-label="Editar despesa variável" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-3"><form onSubmit={e=>{e.preventDefault();void submitVariable(variableEditing==="new"?"add_variable":"edit_variable",variableEditing==="new"?undefined:variableEditing);}} className="w-full max-w-md space-y-3 rounded-2xl border border-[#3b7e8b] bg-[#0d1b24] p-5 shadow-2xl"><h3 className="text-base font-semibold text-white">{variableEditing==="new"?"Adicionar despesa variável":"Editar despesa variável"}</h3><label className="block text-xs text-[#aebdc5]">Nome<input required maxLength={100} value={variableName} onChange={e=>setVariableName(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} /></label><label className="block text-xs text-[#aebdc5]">Categoria<input required maxLength={80} value={variableCategory} onChange={e=>setVariableCategory(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} /></label><label className="block text-xs text-[#aebdc5]">Descrição opcional<textarea maxLength={2000} value={variableDescription} onChange={e=>setVariableDescription(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} /></label><div className="grid grid-cols-2 gap-2"><label className="block text-xs text-[#aebdc5]">Valor<input required inputMode="decimal" value={variableAmount} onChange={e=>setVariableAmount(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} placeholder="100,00" /></label><label className="block text-xs text-[#aebdc5]">Moeda<select value={variableCurrency} onChange={e=>setVariableCurrency(e.target.value as "BRL"|"USD")} className={`${PALETTE.input} mt-1 w-full`}><option value="BRL">BRL</option><option value="USD">USD</option></select></label></div><label className="block text-xs text-[#aebdc5]">Data da despesa<input required type="date" value={variableDate} onChange={e=>setVariableDate(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} /></label><p className="text-[11px] text-[#91a7b6]">Competência calculada: {variableDate?`${variableDate.slice(0,7)}-01`:"—"}</p><div className="flex justify-end gap-2"><button type="button" className="rounded-lg border border-[#3e4b57] px-3 py-2 text-xs text-white" onClick={()=>setVariableEditing(null)}>Cancelar</button><button disabled={saving} type="submit" className={PALETTE.action}>{saving?"Salvando...":"Salvar despesa"}</button></div></form></div>:null}
  </section>;
}
