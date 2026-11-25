'use client';
import {useEffect,useState} from 'react';
import {projectSchedulerFailures,type SchedulerFailure} from '@/lib/diagnostics/scheduler-failure-contract';

const LABELS: Record<SchedulerFailure['component'],string> = {
  sla_alerts:'Alertas de SLA',sla_violations:'Violações de SLA',sla_risk:'Riscos de SLA',sla_snapshot:'Snapshot de SLA',whatsapp_inbox:'Fila do WhatsApp',ai_processor:'Processador de IA',campaign_queue:'Fila de campanhas',sales_ai_worker:'Worker da IA Vendedora',ai_window_resumes:'Retomada de janelas de IA',whatsapp_process_all:'Processamento geral do WhatsApp',assistant_panel_sync:'Sincronização da Assistente',assistant_reports:'Relatórios da Assistente',scheduler_history_retention:'Retenção do histórico de agendamentos',cost_daily:'Custos diários',monthly_preclosure:'Pré-fechamento mensal',cost_retry_morning_1:'Custos: primeira tentativa complementar',cost_retry_morning_2:'Custos: segunda tentativa complementar',diagnostic_ai_runs:'Diagnósticos de IA',diagnostic_operational:'Diagnósticos operacionais',
};
const REASONS: Record<SchedulerFailure['reported_reason'],string> = {
  unknown:'Motivo não identificado',scheduler_reported_cancellation:'Cancelamento relatado pelo agendador',scheduler_reported_connection_failure:'Falha de conexão relatada pelo agendador',scheduler_reported_restart:'Reinício relatado pelo agendador',
};
function formatTime(value: string|null): string {
  return value ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium',timeZone:'America/Sao_Paulo'}).format(new Date(value)) : 'Não comprovado';
}
function buildSchedulerText(item: SchedulerFailure): string {
  return [
    'ZION-ADM | Falha de agendamento', 'Fonte: pg_cron', 'Escopo: agendador (loja não atribuída)',
    `Componente: ${item.component}`, `Job ID: ${item.job_id}`, `Run ID: ${item.run_id}`,
    `Código: ${item.technical_error_code}`, `Motivo relatado: ${REASONS[item.reported_reason]}`,
    `Início da falha: ${item.failed_started_at}`, `Fim da execução com falha: ${item.failed_ended_at ?? 'Não comprovado'}`,
    `Agendamento ativo na consulta: ${item.job_active ? 'Sim' : 'Não'}`,
    `Primeiro sucesso posterior (início): ${item.subsequent_success_started_at ?? 'Não comprovado'}`,
    `Primeiro sucesso posterior (fim): ${item.subsequent_success_ended_at ?? 'Não comprovado'}`,
    'Causa raiz: não comprovada.', 'Recuperação comercial: não comprovada. Sucesso posterior do cron não comprova resposta HTTP ou recuperação operacional.',
  ].join('\n');
}
export default function ZionAdminSchedulerFailures() {
  const [refresh,setRefresh] = useState(0);
  const [result,setResult] = useState<{key:number;items:SchedulerFailure[];error:boolean}|null>(null);
  const [copy,setCopy] = useState<{id:number;ok:boolean}|null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),45000);
    async function load() {
      try {
        const response = await fetch('/api/zion-admin/diagnostics/scheduler?limit=50',{credentials:'include',cache:'no-store',signal:controller.signal});
        if (!response.ok) throw new Error('SCHEDULER_UNAVAILABLE');
        const payload = await response.json();
        const items = payload?.ok === true && payload.source === 'pg_cron' && payload.window_days === 7 && payload.limit === 50 ? projectSchedulerFailures(payload.items,50) : null;
        if (items === null) throw new Error('SCHEDULER_INVALID');
        if (controller.signal.aborted) throw new Error("SCHEDULER_TIMEOUT");
        if (!disposed) setResult({key:refresh,items,error:false});
      } catch { if (!disposed) setResult({key:refresh,items:[],error:true}); }
      finally { clearTimeout(timer); }
    }
    let disposed = false;
    void load();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  },[refresh]);
  const loading = result?.key !== refresh;
  const items = loading ? [] : result?.items ?? [];
  async function copyDetails(item: SchedulerFailure) {
    try { await navigator.clipboard.writeText(buildSchedulerText(item)); setCopy({id:item.run_id,ok:true}); }
    catch { setCopy({id:item.run_id,ok:false}); }
  }
  return <section aria-label="Falhas de agendamento" className="space-y-2 rounded-lg border border-[#385563] p-3 text-xs text-[#bed4df]">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h5 className="font-semibold text-[#d6f5fa]">Falhas de agendamento</h5>
      <button type="button" disabled={loading} onClick={()=>{setCopy(null);setRefresh(n=>n+1);}} className="rounded border border-[#385563] px-2 py-1 disabled:opacity-40">Atualizar</button>
    </div>
    <p>Até 50 falhas dos últimos sete dias, no histórico disponível do pg_cron. Consulta geral, independente dos filtros de loja e origem acima. Horários de Brasília.</p>
    <p>Uma execução posterior bem-sucedida não comprova recuperação comercial nem resposta HTTP da API.</p>
    {loading ? <p role="status">Consultando agendamentos…</p> : result?.error ? <p role="alert">Histórico indisponível. Atualize para tentar novamente.</p> : items.length === 0 ? <p>Nenhuma falha encontrada no histórico consultado. Isso não comprova disponibilidade integral.</p> : <p>{items.length} falha(s) retornada(s){items.length===50?' — limite da consulta atingido.':''}</p>}
    {items.map(item=><details key={item.run_id} className="rounded border border-[#305362] p-2">
      <summary className="cursor-pointer">{LABELS[item.component]} — {formatTime(item.failed_started_at)} — {item.subsequent_success_ended_at?'Sucesso posterior registrado':'Sem sucesso posterior comprovado'}</summary>
      <p className="mt-2">{REASONS[item.reported_reason]}. Primeiro sucesso posterior: {formatTime(item.subsequent_success_ended_at)}.</p>
      <button type="button" onClick={()=>void copyDetails(item)} className="my-2 rounded border border-[#385563] px-2 py-1">Copiar detalhes técnicos</button>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{buildSchedulerText(item)}</pre>
      {copy?.id===item.run_id?<p role="status">{copy.ok?'Detalhes copiados.':'Não foi possível copiar. Selecione o texto.'}</p>:null}
    </details>)}
  </section>;
}
