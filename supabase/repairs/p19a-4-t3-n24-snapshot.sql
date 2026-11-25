-- N24 snapshot: read only. Execute before and after the rehearsal.
with signatures(signature) as (values
  ('public.ensure_human_takeover_lease_by_system(uuid)'),
  ('public.human_release_conversation_to_ai(uuid,text,text)'),
  ('public.human_takeover_conversation(uuid,text)'),
  ('public.insert_message(uuid,text,text,text,text,text,text,jsonb)'),
  ('public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'),
  ('public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'),
  ('public.process_stale_human_conversations()'),
  ('public.record_human_takeover_activity_by_system(uuid,uuid,uuid,text,text)'),
  ('public.release_human_takeover_lease_by_system(uuid,text)'),
  ('public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'),
  ('public.materialize_sales_ai_reply_set_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb,jsonb)'),
  ('public._apply_conversation_state_transition(uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'),
  ('public._apply_conversation_state_transition_controlled(boolean,uuid,text,text,uuid,text,text,jsonb,text,uuid,boolean)'),
  ('public._conversation_transition_context(uuid)')
), relations(signature) as (values
  ('public.conversation_human_takeover_leases'),
  ('public.conversation_human_takeover_activity_events')
)
select 'function' as kind, s.signature, p.oid is not null as present,
       md5(pg_get_functiondef(p.oid)) as definition_md5, p.proacl::text as acl,
       pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
       p.proconfig::text as config, null::boolean as rls
from signatures s left join pg_catalog.pg_proc p on p.oid = to_regprocedure(s.signature)
union all
select 'table', r.signature, c.oid is not null, null, c.relacl::text,
       pg_get_userbyid(c.relowner), null, null, c.relrowsecurity
from relations r left join pg_catalog.pg_class c on c.oid = to_regclass(r.signature)
order by kind, signature;
