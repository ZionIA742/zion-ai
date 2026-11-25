-- P9 / MICROETAPA 10.7-A1.1
-- Diagnostico remoto somente leitura. Nao cria objetos, nao grava dados,
-- nao chama RPCs operacionais e nao cria jobs.
--
-- A identidade individual de destinatarios foi cancelada; este diagnostico
-- cobre somente o canal interno da loja e o WhatsApp ja cadastrado.

do $cron_inventory$
declare
  v_job record;
  v_run record;
begin
  if pg_catalog.to_regclass('cron.job') is null then
    raise notice 'P10_7_A1_1_CRON_JOB=BLOQUEADO: relacao cron.job ausente';
  else
    for v_job in execute $sql$
      select jobid, schedule, command, active
        from cron.job
       order by jobid
    $sql$ loop
      raise notice 'P10_7_A1_1_CRON_JOB jobid=% schedule=% active=% command=%',
        v_job.jobid, v_job.schedule, v_job.active, v_job.command;
    end loop;
  end if;

  if pg_catalog.to_regclass('cron.job_run_details') is null then
    raise notice 'P10_7_A1_1_CRON_RUN_DETAILS=BLOQUEADO: relacao cron.job_run_details ausente';
  else
    for v_run in execute $sql$
      select jobid, runid, status, start_time, end_time
        from cron.job_run_details
       order by start_time desc nulls last
       limit 20
    $sql$ loop
      raise notice 'P10_7_A1_1_CRON_RUN jobid=% runid=% status=% start=% end=%',
        v_run.jobid, v_run.runid, v_run.status, v_run.start_time, v_run.end_time;
    end loop;
  end if;
end
$cron_inventory$;

with
required_relations(object_identity) as (
  values
    ('public.messages'),
    ('public.conversations'),
    ('public.memberships'),
    ('public.store_responsibles'),
    ('public.store_assistant_notification_queue'),
    ('public.store_responsible_external_notifications'),
    ('public.conversation_human_response_commitments'),
    ('public.conversation_human_takeover_leases')
),
relation_checks as (
  select 'base relation'::text as category,
    object_identity,
    pg_catalog.to_regclass(object_identity) is not null as ok,
    case when pg_catalog.to_regclass(object_identity) is not null
      then 'relation exists' else 'relation missing' end as details
  from required_relations
),
required_columns(table_name, column_name, expected_type) as (
  values
    ('messages','id','uuid'),
    ('messages','organization_id','uuid'),
    ('messages','store_id','uuid'),
    ('messages','conversation_id','uuid'),
    ('messages','sender','text'),
    ('messages','direction','text'),
    ('messages','deleted_at','timestamptz'),
    ('messages','created_at','timestamptz'),
    ('messages','metadata','jsonb'),
    ('conversations','id','uuid'),
    ('conversations','organization_id','uuid'),
    ('conversations','lead_id','uuid'),
    ('memberships','organization_id','uuid'),
    ('memberships','user_id','uuid'),
    ('store_responsibles','id','uuid'),
    ('store_responsibles','organization_id','uuid'),
    ('store_responsibles','store_id','uuid'),
    ('store_responsibles','is_primary','bool'),
    ('store_responsibles','is_active','bool'),
    ('store_responsibles','whatsapp_number','text'),
    ('store_assistant_notification_queue','id','uuid'),
    ('store_assistant_notification_queue','organization_id','uuid'),
    ('store_assistant_notification_queue','store_id','uuid'),
    ('store_assistant_notification_queue','notification_type','text'),
    ('store_assistant_notification_queue','status','text'),
    ('store_assistant_notification_queue','context','jsonb'),
    ('store_assistant_notification_queue','related_conversation_id','uuid'),
    ('store_responsible_external_notifications','id','uuid'),
    ('store_responsible_external_notifications','organization_id','uuid'),
    ('store_responsible_external_notifications','store_id','uuid'),
    ('store_responsible_external_notifications','responsible_id','uuid'),
    ('store_responsible_external_notifications','internal_notification_id','uuid'),
    ('store_responsible_external_notifications','source_event_key','text'),
    ('conversation_human_response_commitments','organization_id','uuid'),
    ('conversation_human_response_commitments','store_id','uuid'),
    ('conversation_human_response_commitments','conversation_id','uuid'),
    ('conversation_human_response_commitments','source_message_id','uuid'),
    ('conversation_human_response_commitments','responsible_user_id','uuid'),
    ('conversation_human_response_commitments','due_at','timestamptz'),
    ('conversation_human_response_commitments','status','text'),
    ('conversation_human_takeover_leases','conversation_id','uuid'),
    ('conversation_human_takeover_leases','organization_id','uuid'),
    ('conversation_human_takeover_leases','store_id','uuid'),
    ('conversation_human_takeover_leases','released_at','timestamptz'),
    ('conversation_human_takeover_leases','hard_hold','bool')
),
column_checks as (
  select 'column/type'::text as category,
    'public.' || x.table_name || '.' || x.column_name as object_identity,
    c.oid is not null and format_type(a.atttypid, a.atttypmod) = x.expected_type as ok,
    case when c.oid is null then 'table missing'
      when a.attnum is null then 'column missing'
      when format_type(a.atttypid, a.atttypmod) <> x.expected_type
        then 'type=' || format_type(a.atttypid, a.atttypmod) || ', expected=' || x.expected_type
      else 'column and type match' end as details
  from required_columns x
  left join pg_catalog.pg_class c
    on c.relnamespace = pg_catalog.to_regnamespace('public')
   and c.relname = x.table_name
   and c.relkind in ('r','p','v','m','f')
  left join pg_catalog.pg_attribute a
    on a.attrelid = c.oid
   and a.attname = x.column_name
   and a.attnum > 0
   and not a.attisdropped
),
required_functions(object_identity) as (
  values
    ('public.read_human_response_commitments_by_system(uuid,uuid,uuid)'),
    ('public.assistant_enqueue_internal_notification(uuid,uuid,text,text,text,text,jsonb,uuid,uuid,uuid,text)')
),
function_checks as (
  select 'base function'::text as category,
    object_identity,
    pg_catalog.to_regprocedure(object_identity) is not null as ok,
    case when pg_catalog.to_regprocedure(object_identity) is not null
      then 'signature exists' else 'signature missing' end as details
  from required_functions
),
fk_checks as (
  select 'foreign key'::text as category, x.object_identity,
    exists (
      select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class child on child.oid = c.conrelid
      join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
      join pg_catalog.pg_class parent on parent.oid = c.confrelid
      join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
      where c.contype = 'f'
        and child_ns.nspname = 'public'
        and parent_ns.nspname = 'public'
        and child.relname = x.child_table
        and parent.relname = x.parent_table
        and pg_catalog.pg_get_constraintdef(c.oid, true) ~* x.definition_pattern
    ) as ok,
    'required scoped relationship'::text as details
  from (values
    ('messages -> conversations','messages','conversations','conversation_id.*conversations'),
    ('conversations -> leads','conversations','leads','lead_id.*leads'),
    ('takeover lease -> conversations','conversation_human_takeover_leases','conversations','conversation_id.*conversations'),
    ('external notification -> queue','store_responsible_external_notifications','store_assistant_notification_queue','internal_notification_id.*store_assistant_notification_queue'),
    ('external notification -> responsible','store_responsible_external_notifications','store_responsibles','responsible_id.*store_responsibles'),
    ('commitment -> messages','conversation_human_response_commitments','messages','source_message_id.*messages'),
    ('commitment -> responsible user','conversation_human_response_commitments','memberships','responsible_user_id.*memberships')
  ) as x(object_identity, child_table, parent_table, definition_pattern)
),
index_checks as (
  select 'index'::text as category, x.object_identity,
    exists (
      select 1 from pg_catalog.pg_class i
      join pg_catalog.pg_namespace ns on ns.oid = i.relnamespace
      join pg_catalog.pg_index ix on ix.indexrelid = i.oid
      join pg_catalog.pg_class t on t.oid = ix.indrelid
      where ns.nspname = 'public'
        and i.relkind = 'i'
        and t.relname = x.table_name
        and pg_catalog.pg_get_indexdef(i.oid) ~* x.definition_pattern
    ) as ok,
    x.details
  from (values
    ('message conversation ordering','messages','conversation_id.*created_at','index covering conversation_id and created_at'),
    ('responsible store scope','store_responsibles','organization_id.*store_id','index covering organization_id and store_id'),
    ('external event dedup','store_responsible_external_notifications','source_event_key','index covering source_event_key'),
    ('commitment active lookup','conversation_human_response_commitments','organization_id.*store_id.*conversation_id.*due_at','index covering commitment scope and due_at')
  ) as x(object_identity, table_name, definition_pattern, details)
  where exists (
    select 1 from pg_catalog.pg_class t
    join pg_catalog.pg_namespace ns on ns.oid = t.relnamespace
    where ns.nspname = 'public' and t.relname = x.table_name
  )
),
cron_catalog as (
  select 'scheduler'::text as category,
    'cron.job / cron.job_run_details'::text as object_identity,
    pg_catalog.to_regclass('cron.job') is not null
      and pg_catalog.to_regclass('cron.job_run_details') is not null as ok,
    case when pg_catalog.to_regclass('cron.job') is null
      then 'pg_cron job relation unavailable'
      when pg_catalog.to_regclass('cron.job_run_details') is null
      then 'pg_cron run history relation unavailable'
      else 'pg_cron catalog available; job rows emitted as NOTICE' end as details
),
all_checks as (
  select * from relation_checks
  union all select * from column_checks
  union all select * from function_checks
  union all select * from fk_checks
  union all select * from index_checks
  union all select * from cron_catalog
),
summary as (
  select
    bool_and(ok) as base_ok,
    bool_and(ok) filter (where category = 'scheduler') as scheduler_ok,
    count(*) filter (where not ok) as blocking_count
  from all_checks
)
select
  'P10_7_A1_1_ALERT_INFRASTRUCTURE_PREFLIGHT'::text as diagnostic,
  case when s.blocking_count = 0 and s.scheduler_ok
    then 'APTO_PARA_CONTRATO_A1'
    else 'BLOQUEADO' end as verdict,
  c.category,
  c.object_identity,
  case when c.ok then 'PASS' else 'BLOQUEADO' end as check_verdict,
  c.details
from all_checks c
cross join summary s
order by c.category, c.object_identity;
