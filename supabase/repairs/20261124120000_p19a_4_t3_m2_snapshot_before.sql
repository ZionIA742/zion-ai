-- P19-A / Bloco 4 / 4-T3-M.2 / A
-- Snapshot anterior, somente leitura. Executar separadamente antes de B.
-- A saida e comparavel byte a byte com o snapshot C apos substituir apenas
-- o literal da fase ('A' por 'C'). Nao criar tabelas, nao conceder ACLs.

with targets(object_kind, object_identity) as (
  values
    ('table'::text, 'public.conversation_human_takeover_leases'::text),
    ('table'::text, 'public.conversation_human_takeover_activity_events'::text),
    ('function'::text, 'public.ensure_human_takeover_lease_by_system(uuid)'::text),
    ('function'::text, 'public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text)'::text),
    ('function'::text, 'public.release_human_takeover_lease_by_system(uuid,text)'::text),
    ('function'::text, 'public.human_takeover_conversation(uuid,text)'::text),
    ('function'::text, 'public.human_release_conversation_to_ai(uuid,text,text)'::text),
    ('function'::text, 'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::text),
    ('function'::text, 'public.insert_message(uuid,text,text,text,text,text,text,jsonb)'::text),
    ('function'::text, 'public.process_stale_human_conversations()'::text),
    ('function'::text, 'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'::text),
    ('function'::text, 'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::text)
)
select
  'A'::text as snapshot_phase,
  t.object_kind,
  t.object_identity,
  case when t.object_kind = 'table' then c.oid is not null else p.oid is not null end as present,
  case when p.oid is null then null else md5(pg_catalog.pg_get_functiondef(p.oid)) end as definition_md5,
  case when t.object_kind = 'table' then c.relacl::text else p.proacl::text end as acl,
  case when c.oid is null then null else c.relrowsecurity end as relrowsecurity,
  case when p.oid is null then null else p.prosecdef end as security_definer,
  case when p.oid is null then null else p.proconfig::text end as config
from targets t
left join lateral (
  select c.oid, c.relacl, c.relrowsecurity
  from pg_catalog.pg_class c
  where t.object_kind = 'table'
    and c.oid = pg_catalog.to_regclass(t.object_identity)
) c on true
left join lateral (
  select p.oid, p.proacl, p.prosecdef, p.proconfig
  from pg_catalog.pg_proc p
  where t.object_kind = 'function'
    and p.oid = pg_catalog.to_regprocedure(t.object_identity)
) p on true
order by t.object_kind, t.object_identity;
