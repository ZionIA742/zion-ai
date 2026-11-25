-- P10.7 / MICROETAPA 10.7-A1.4
-- Diagnostico remoto somente leitura do job que chama whatsapp-process-all.
-- Nao cria, altera ou remove jobs; nao executa a rota; nao imprime o comando,
-- URLs, tokens, headers ou qualquer outro segredo configurado no cron.

do $diagnostic$
declare
  v_job record;
  v_match_count integer := 0;
begin
  if pg_catalog.to_regclass('cron.job') is null then
    raise notice 'P10_7_A1_4_CRON=BLOQUEADO: cron.job ausente';
    return;
  end if;

  for v_job in
    select
      j.jobid,
      j.schedule,
      j.active,
      (j.command ilike '%/api/cron/whatsapp-process-all%'
        or j.command ilike '%whatsapp-process-all%') as target_match,
      md5(j.command) as command_md5
    from cron.job j
    order by j.jobid
  loop
    if v_job.target_match then
      v_match_count := v_match_count + 1;
    end if;
    raise notice
      'P10_7_A1_4_CRON_JOB jobid=% schedule=% active=% target_match=% command_md5=%',
      v_job.jobid, v_job.schedule, v_job.active, v_job.target_match, v_job.command_md5;
  end loop;

  if pg_catalog.to_regclass('cron.job_run_details') is null then
    raise notice 'P10_7_A1_4_CRON_HISTORY=BLOQUEADO: cron.job_run_details ausente';
    return;
  end if;

  if v_match_count = 0 then
    raise notice 'P10_7_A1_4_CRON_TARGET=NAO_ENCONTRADO';
    return;
  end if;

  for v_job in
    select h.jobid, h.runid, h.status, h.start_time, h.end_time
      from cron.job_run_details h
      join cron.job j on j.jobid = h.jobid
     where j.command ilike '%/api/cron/whatsapp-process-all%'
        or j.command ilike '%whatsapp-process-all%'
     order by h.start_time desc nulls last
     limit 20
  loop
    raise notice
      'P10_7_A1_4_CRON_RUN jobid=% runid=% status=% start=% end=%',
      v_job.jobid, v_job.runid, v_job.status, v_job.start_time, v_job.end_time;
  end loop;
end
$diagnostic$;
