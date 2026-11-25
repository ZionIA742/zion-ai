-- Read-only P9 B10 5.3-I.4 diagnostic. No RPC is executed and no row is
-- mutated. Run with a privileged catalog reader only if remote definitions
-- are missing or the installed state is uncertain.
with required_functions(signature) as (
  values
    ('public.p9_10_4_d_recovery_enqueue_enabled()'),
    ('public.p9_10_4_d_assert_recovery_write_authority(uuid,uuid,uuid,uuid)'),
    ('public.p9_10_4_d_assert_recovery_set_claim_authority(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'),
    ('public.p9_10_4_d_write_recovery_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid)'),
    ('public.p9_10_4_d_transition_recovery_stage_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text)'),
    ('public.release_ai_run_queue_recovery_claim_by_system(uuid,uuid,uuid,uuid)'),
    ('public.issue_quote_preparation_task_authorization_by_system(uuid,uuid,uuid,uuid)'),
    ('public.issue_quote_preparation_task_authorization_by_system(uuid,uuid,uuid,uuid,uuid)'),
    ('public.claim_ai_run_queue_tasks_by_system(uuid,uuid,integer,text,integer,integer)'),
    ('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)')
)
select 'function' as object_kind, f.signature,
       (to_regprocedure(f.signature) is not null) as present,
       p.oid,
       pg_get_userbyid(p.proowner) as owner,
       p.proacl,
       regexp_replace(pg_get_functiondef(p.oid), E'\r\n?', E'\n', 'g') as normalized_definition
from required_functions f
left join pg_proc p on p.oid=to_regprocedure(f.signature)
order by f.signature;

select 'relation' as object_kind, c.oid::regclass::text as relation_name,
       c.relrowsecurity, c.relforcerowsecurity,
       coalesce(array_agg(t.tgname order by t.tgname) filter (where t.tgname is not null), '{}') as triggers
from (values
  ('public.ai_run_queue'),
  ('public.conversation_human_takeover_leases'),
  ('public.conversations'),
  ('public.p19a_sales_ai_reply_sets'),
  ('public.commercial_opportunity_qualification_fact_events'),
  ('public.commercial_opportunity_qualification_facts_current'),
  ('public.commercial_opportunity_stage_lifecycle_events')
) r(relation_name)
left join pg_class c on c.oid=to_regclass(r.relation_name)
left join pg_trigger t on t.tgrelid=c.oid and not t.tgisinternal
group by r.relation_name,c.oid,c.relrowsecurity,c.relforcerowsecurity
order by relation_name;

select 'activation' as object_kind,
       to_regclass('public.zion_p9_recovery_activation') is not null as relation_present,
       max(case when column_name='automatic_enqueue_enabled' then 'present' end) as automatic_enqueue_column,
       max(case when column_name='compatible_consumers_deployed' then 'present' end) as compatible_consumers_column
from information_schema.columns
where table_schema='public' and table_name='zion_p9_recovery_activation';

select 'materializer_anchor_count' as object_kind,
       (length(d)-length(replace(d,'sales_ai_post_materialization_recovery','')))
       / nullif(length('sales_ai_post_materialization_recovery'),0) as recovery_marker_count,
       position('p9_10_4_d_recovery_enqueue_enabled' in d) > 0 as gated,
       position('on conflict (organization_id, queue_key) do nothing' in lower(d)) > 0 as idempotent
from (select regexp_replace(pg_get_functiondef(to_regprocedure(
  'public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'
)), E'\r\n?', E'\n', 'g') d) x;

select n.nspname as schema_name, p.proname,
       pg_get_function_identity_arguments(p.oid) as exact_identity_arguments,
       pg_get_function_result(p.oid) as result_signature,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as configuration,
       p.proacl as acl,
       regexp_replace(pg_get_functiondef(p.oid), E'\r\n?', E'\n', 'g') as normalized_definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('process_next_ai_run_queue','enqueue_ai_run')
order by p.proname, exact_identity_arguments;
