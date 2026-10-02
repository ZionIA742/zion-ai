-- P19-A Bloco 4.7 focused manual checks.
-- Execute only against a disposable DEV transaction when authorized.
-- This file is intentionally not executed by the local audit/implementation.

begin;

do $$
declare
  v_table text;
  v_idempotency_index text;
  v_active_index_oid oid;
  v_active_index_unique boolean;
  v_active_index_predicate text;
  v_active_index_columns text[];
  v_candidate_definition text;
  v_transition_definition text;
begin
  select to_regclass('public.whatsapp_binding_change_requests')::text
    into v_table;
  if v_table is distinct from 'whatsapp_binding_change_requests' then
    raise exception '4.7 check 1 failed: change request table missing';
  end if;

  select indexdef into v_idempotency_index
    from pg_indexes
   where schemaname = 'public'
     and indexname = 'whatsapp_binding_change_requests_idempotency_uidx';
  if v_idempotency_index is null
     or v_idempotency_index not ilike '%organization_id%store_id%provider%idempotency_key%' then
    raise exception '4.7 check 2 failed: tenant/provider/idempotency uniqueness missing';
  end if;

  select
    i.indexrelid,
    i.indisunique,
    pg_get_expr(i.indpred, i.indrelid),
    array_agg(a.attname::text order by k.ordinality)
    into
      v_active_index_oid,
      v_active_index_unique,
      v_active_index_predicate,
      v_active_index_columns
    from pg_index i
    join pg_class idx
      on idx.oid = i.indexrelid
    join pg_namespace ns
      on ns.oid = idx.relnamespace
    join pg_class tbl
      on tbl.oid = i.indrelid
    left join lateral unnest(i.indkey) with ordinality as k(attnum, ordinality)
      on true
    left join pg_attribute a
      on a.attrelid = i.indrelid
     and a.attnum = k.attnum
   where ns.nspname = 'public'
     and idx.relname = 'whatsapp_binding_change_requests_active_uidx'
     and tbl.relname = 'whatsapp_binding_change_requests'
   group by i.indexrelid, i.indisunique, i.indpred, i.indrelid;

  if v_active_index_oid is null
     or v_active_index_unique is distinct from true
     or v_active_index_predicate is null
     or v_active_index_columns is distinct from array['organization_id','store_id','provider']::text[]
     or v_active_index_predicate not ilike '%requested%'
     or v_active_index_predicate not ilike '%awaiting_customer_authorization%'
     or v_active_index_predicate not ilike '%customer_authorizing%'
     or v_active_index_predicate not ilike '%candidate_received%'
     or v_active_index_predicate not ilike '%validating%'
     or v_active_index_predicate not ilike '%ready_to_cutover%'
     or v_active_index_predicate ilike '%completed%'
     or v_active_index_predicate ilike '%failed%'
     or v_active_index_predicate ilike '%cancelled%'
     or v_active_index_predicate ilike '%expired%' then
    raise exception '4.7 check 3 failed: one active request partial uniqueness missing or invalid';
  end if;

  select pg_get_functiondef('public.materialize_whatsapp_binding_candidate_by_system(uuid,uuid,text,text,text,text,text,jsonb)'::regprocedure)
    into v_candidate_definition;
  if v_candidate_definition not ilike '%security definer%'
     or v_candidate_definition ilike '%update public.external_integrations%'
     or v_candidate_definition ilike '%insert into public.external_integrations%' then
    raise exception '4.7 check 4 failed: candidate writer is not isolated from active integration';
  end if;

  select pg_get_functiondef('public.advance_whatsapp_binding_change_request_by_system(uuid,uuid,uuid,text)'::regprocedure)
    into v_transition_definition;
  if v_transition_definition not ilike '%ready_to_cutover%'
     or v_transition_definition ilike '%p_next_status = ''completed''%' then
    raise exception '4.7 check 5 failed: pre-cutover state machine contract invalid';
  end if;

  raise notice '4.7 structural checks passed: table, uniqueness, scoped writer, active preservation, pre-cutover states';
end;
$$;

rollback;
